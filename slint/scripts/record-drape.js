// Records the original Halation's Drape (its own drape.js, latest main) for the native beta's Home loop, as Java
// allowed on 2026-10-21: the original code is used only here, to render and adjust frames; the beta ships the frames.
//
// Seamless loop: the copy used here makes the Drape's time periodic. Each time-dependent noise lookup moves on a
// circle through the noise volume (time axis plus a small offset across) at the original speed, and the diagonal
// slide becomes a wide circle at the original speed; at t = 0 both start like the original. Frame PERIOD equals frame 0.
// The frames carry no dither (see the swaps below).
//
// Precision: the loop is read from the shader as 16-bit luma (a second copy packs it into two channels), and the curve
// below is applied to that before the one rounding to 8 bits. Frames read back as 8-bit colour were already rounded to
// whole levels: the dark field was a stair of one-level plateaus, which the beta's dither cannot smooth once the frame
// is scaled six times; the original never had them because it rounds once, at the window, after its dither.
//
// Writes (in <out dir>):
//   frames/y0000.bin …  FRAMES frames of 320 x 180 16-bit luma (little-endian, 0..65535 for 0..1), 15 per field
//                       second, no grain
//   drape-loop.mp4      the frames' luma as H.264, when FFMPEG names an ffmpeg with libx264 (x264 veryslow, CRF 16,
//                       aq-mode 3, one keyframe, full range): y' = 255 * sqrt(min(1, luma / LIFT)), so the dark field gets
//                       most of the codes. The beta reads the Y plane with Windows' own decoder, undoes the curve and
//                       colours each pixel from drape-tint.bin. Colour stays out of the codec: its 4:2:0 chroma at
//                       320 x 180 made blocks and bands once scaled to the window.
//   drape-tint.bin      256 x RGB (u8): the average colour of every 30th frame for each luma, filled across gaps
//   drape-still.jpg     frame 0, shown when the loop does not play (reduced motion, no decoder)
//   drape-grain.png     256 x 256 RGBA tile of the original's output dither and stationary film grain together (signed:
//                       white adds, black takes away), laid over the scaled frame at the window's own resolution
//   drape-original-1920.png, drape-periodic-1920.png  the unmodified and the periodic Drape at t = 0, full size
// Usage: node record.js <dist dir of the original> <out dir>   (CHROME, NODE_PATH and FFMPEG as needed)
const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");
const { chromium } = require("playwright");
const [, , dist, out] = process.argv;
const PERIOD = 120, FRAMES = 1800, W = 320, H = 180, GRAIN = 256, QUALITY = 0.9, LIFT = 80;

// The periodic copy of drape.js: exact replacements, each must match once
function periodic(src, luma16 = false) {
  const rate = Number(src.match(/rate: ([.\d]+)/)[1]), R = rate * PERIOD / (2 * Math.PI);
  const swaps = [
    // GLSL: the loop radius and the lookup on the circle, then the slide and each time lookup
    ["vec2 axisSpace(vec2 p,float t){", `const float LOOP_R=${R.toFixed(8)};
vec3 lp(vec2 xy,float t,float k){return vec3(xy+vec2(0.0,k*LOOP_R*(1.0-cos(t/LOOP_R))),k*LOOP_R*sin(t/LOOP_R));}
vec2 axisSpace(vec2 p,float t){`],
    ["a.x-=t*${f4(F.drift)};", "a-=${f4(F.drift)}*LOOP_R*vec2(sin(t/LOOP_R),1.0-cos(t/LOOP_R));"],
    ["vec2 q=vec2(fbm(vec3(a,t)),fbm(vec3(a+vec2(5.2,1.3),t)));", "vec2 q=vec2(fbm(lp(a,t,1.0)),fbm(lp(a+vec2(5.2,1.3),t,1.0)));"],
    ["fbm(vec3(a+1.1*q+vec2(1.7,9.2),t*1.3))", "fbm(lp(a+1.1*q+vec2(1.7,9.2),t,1.3))"],
    ["fbm(vec3(a+1.1*q+vec2(8.3,2.8),t*1.3))", "fbm(lp(a+1.1*q+vec2(8.3,2.8),t,1.3))"],
    ["float h=fbm(vec3(w,t*0.7));", "float h=fbm(lp(w,t,0.7));"],
    ["snoise(vec3(a*vec2(0.3,0.54)+vec2(3.1,7.7),t*0.6))", "snoise(lp(a*vec2(0.3,0.54)+vec2(3.1,7.7),t,0.6))"],
    // JavaScript (the exposure estimate) in step with the shader
    ["const axisSpace = (px, py, t) => [(px * AXIS[0] + py * AXIS[1]) * F.along * F.scale - t * F.drift, (py * AXIS[0] - px * AXIS[1]) * F.across * F.scale];",
      `const LOOP_R = ${R.toFixed(8)}, ly = (t, k) => k * LOOP_R * (1 - Math.cos(t / LOOP_R)), lz = (t, k) => k * LOOP_R * Math.sin(t / LOOP_R);
const axisSpace = (px, py, t) => [(px * AXIS[0] + py * AXIS[1]) * F.along * F.scale - F.drift * LOOP_R * Math.sin(t / LOOP_R), (py * AXIS[0] - px * AXIS[1]) * F.across * F.scale - F.drift * LOOP_R * (1 - Math.cos(t / LOOP_R))];`],
    ["const qx = fbm(ax, ay, t), qy = fbm(ax + 5.2, ay + 1.3, t);", "const qx = fbm(ax, ay + ly(t, 1), lz(t, 1)), qy = fbm(ax + 5.2, ay + 1.3 + ly(t, 1), lz(t, 1));"],
    ["fbm(ax + 1.1 * qx + 1.7, ay + 1.1 * qy + 9.2, t * 1.3)", "fbm(ax + 1.1 * qx + 1.7, ay + 1.1 * qy + 9.2 + ly(t, 1.3), lz(t, 1.3))"],
    ["fbm(ax + 1.1 * qx + 8.3, ay + 1.1 * qy + 2.8, t * 1.3)", "fbm(ax + 1.1 * qx + 8.3, ay + 1.1 * qy + 2.8 + ly(t, 1.3), lz(t, 1.3))"],
    ["const h = fbm(wx, wy, t * .7);", "const h = fbm(wx, wy + ly(t, .7), lz(t, .7));"],
    ["snoise(ax * .3 + 3.1, ay * .54 + 7.7, t * .6)", "snoise(ax * .3 + 3.1, ay * .54 + 7.7 + ly(t, .6), lz(t, .6))"],
    // No dither in the recorded frames: at 320 px it would be smeared by the scaling and eaten by the codec. The beta
    // dithers at the window's own resolution instead.
    ["  col+=vec3(tpdf(fc,0.0),tpdf(fc+13.7,0.0),tpdf(fc+41.9,0.0))/255.0;", ""],
    ['gl.uniform1f(f.u.u_dither, res.storage === "rgba8" ? 1 : 0);', "gl.uniform1f(f.u.u_dither, 0);"]
  ];
  // The luma copy: the presented pixel's luma as 16 bits, high byte in red and low byte in green
  if (luma16) swaps.push(["col+=vec3(filmGrain(fc,0.0))*mix(1.0,1.4,smoothstep(0.0,0.2,luma))*u_grain;",
    "float l16=floor(clamp(dot(max(col,0.0),vec3(0.2126,0.7152,0.0722)),0.0,1.0)*65535.0+0.5),hi=floor(l16/256.0);" +
    "gl_FragColor=vec4(hi/255.0,(l16-hi*256.0)/255.0,0.0,1.0);return;"]);
  for (const [from, to] of swaps) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw Error(`expected one "${from.slice(0, 60)}", found ${n}`);
    src = src.replace(from, () => to);
  }
  return src;
}

const page = (w, h, drapeFile) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#000;overflow:hidden}.drape-host{position:fixed;left:0;top:0;width:${w}px;height:${h}px}
.drape-surface{position:absolute;inset:0}canvas{display:block;width:100%;height:100%}</style>
<script>
// A still render budget: the recorder draws each frame itself with sceneAt
window.__renderBudget={visible:true,focused:true,reduced:false,profile:{name:"high",fps:60,dpr:1,scale:1,fieldScale:.5},
  add(){return{start(){},stop(){},setFps(){},request(){},dispose(){},active:false}},subscribe(){return()=>{}},interaction(){},state(){return{}}};
</script>
<script src="${"file:///" + path.join(dist, "blue-noise.js").replace(/\\/g, "/")}"></script>
<script src="${"file:///" + drapeFile.replace(/\\/g, "/")}"></script>
</head><body><div class="drape-host"><div class="drape-surface" id="s"></div></div><script>
const d = window.__drape.create(document.getElementById("s"), {});
const grab = () => { const c = document.querySelector("canvas"), k = document.createElement("canvas"); k.width = c.width; k.height = c.height;
  const g = k.getContext("2d"); g.drawImage(c, 0, 0); return [k, g.getImageData(0, 0, k.width, k.height).data]; };
window.frameAt = (t, grain) => { d.canvas.__drapeReview.setGrainStrength(grain); d.sceneAt({ time: t }); return Array.from(grab()[1]); };
window.pngAt = t => { d.canvas.__drapeReview.setGrainStrength(0); d.sceneAt({ time: t }); return grab()[0].toDataURL("image/png"); };
window.jpegAt = (t, q) => { d.canvas.__drapeReview.setGrainStrength(0); d.sceneAt({ time: t }); return grab()[0].toDataURL("image/jpeg", q); };
window.luma16At = t => { d.canvas.__drapeReview.setGrainStrength(0); d.sceneAt({ time: t }); const px = grab()[1], y = new Uint16Array(px.length / 4);
  for (let i = 0; i < y.length; i++) y[i] = px[i * 4] * 256 + px[i * 4 + 1]; return { storage: d.canvas.__drapeState().fieldStorage, y: Array.from(y) }; };
window.sizeOf = () => { const c = document.querySelector("canvas"); return [c.width, c.height]; };
</script></body></html>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const original = path.join(dist, "drape.js"), copy = path.join(out, "drape-periodic.js");
  const lumaCopy = path.join(out, "drape-periodic-luma16.js");
  fs.writeFileSync(copy, periodic(fs.readFileSync(original, "utf8")));
  fs.writeFileSync(lumaCopy, periodic(fs.readFileSync(original, "utf8"), true));
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"] });
  const open = async (w, h, file, name) => {
    const html = path.join(out, name);
    fs.writeFileSync(html, page(w, h, file));
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on("pageerror", e => console.error("page error", e.message));
    await p.goto("file:///" + html.replace(/\\/g, "/"));
    return p;
  };

  // The loop
  const p = await open(W, H, copy, "loop.html");
  console.log("canvas", await p.evaluate(() => window.sizeOf()));
  const mad = (a, b) => { let s = 0, m = 0; for (let j = 0; j < a.length; j += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(a[j + c] - b[j + c]); s += d; m = Math.max(m, d); } return [s / (a.length / 4 * 3), m]; };
  const first = await p.evaluate(([t]) => window.frameAt(t, 0), [0]);
  const end = await p.evaluate(([t]) => window.frameAt(t, 0), [PERIOD]);
  const second = await p.evaluate(([t]) => window.frameAt(t, 0), [PERIOD / FRAMES]);
  const [seam, seamMax] = mad(first, end), [step, stepMax] = mad(first, second);
  console.log(`seam (frame ${PERIOD} s vs 0 s): mean ${seam.toFixed(4)}, max ${seamMax}; one frame apart: mean ${step.toFixed(3)}, max ${stepMax}`);
  const framesDir = path.join(out, "frames"), frameFile = i => path.join(framesDir, `y${String(i).padStart(4, "0")}.bin`);
  fs.mkdirSync(framesDir, { recursive: true });
  const lp = await open(W, H, lumaCopy, "loop-luma16.html");
  // REUSE_FRAMES=1 keeps frames already rendered (the encoding can be redone without rendering again)
  for (let i = 0; i < FRAMES; i++) {
    if (process.env.REUSE_FRAMES && fs.existsSync(frameFile(i))) continue;
    const { storage, y } = await lp.evaluate(([t]) => window.luma16At(t), [i * PERIOD / FRAMES]);
    // a field kept in 8 bits would bring the plateaus back
    if (storage !== "half-float") throw Error(`the field is stored as ${storage}, not half-float`);
    fs.writeFileSync(frameFile(i), Buffer.from(new Uint16Array(y).buffer));
  }
  const still = await p.evaluate(([t, q]) => window.jpegAt(t, q), [0, QUALITY]);
  fs.writeFileSync(path.join(out, "drape-still.jpg"), Buffer.from(still.split(",")[1], "base64"));

  // Colour by luma, from every 30th frame in colour
  const luma = (r, g, b) => Math.round(.2126 * r + .7152 * g + .0722 * b);
  const sums = Array.from({ length: 256 }, () => [0, 0, 0, 0]), samples = [];
  for (let i = 0; i < FRAMES; i += 30) {
    const px = await p.evaluate(([t]) => window.frameAt(t, 0), [i * PERIOD / FRAMES]);
    samples.push(px);
    for (let j = 0; j < px.length; j += 4) { const s4 = sums[luma(px[j], px[j + 1], px[j + 2])]; s4[0] += px[j]; s4[1] += px[j + 1]; s4[2] += px[j + 2]; s4[3]++; }
  }
  const known = sums.map((v, y) => v[3] ? y : -1).filter(y => y >= 0);
  const tint = Buffer.alloc(256 * 3);
  for (let y = 0; y < 256; y++) {
    const lo = [...known].reverse().find(k => k <= y), hi = known.find(k => k >= y);
    const avg = k => sums[k].slice(0, 3).map(c => c / sums[k][3]);
    // past the brightest luma seen, keep that colour's proportions
    const c = lo === undefined ? avg(hi) : hi === undefined ? avg(lo).map(v => v * y / Math.max(1, lo))
      : lo === hi ? avg(lo) : avg(lo).map((v, i) => v + (avg(hi)[i] - v) * (y - lo) / (hi - lo));
    c.forEach((v, i) => { tint[y * 3 + i] = Math.max(0, Math.min(255, Math.round(v))); });
  }
  fs.writeFileSync(path.join(out, "drape-tint.bin"), tint);
  let err = 0, n = 0;
  for (const px of samples) for (let j = 0; j < px.length; j += 4, n++) { const y = luma(px[j], px[j + 1], px[j + 2]); for (let i = 0; i < 3; i++) err += Math.abs(tint[y * 3 + i] - px[j + i]); }
  console.log(`tint: luma up to ${known[known.length - 1]}, mean colour error ${(err / n).toFixed(2)} levels (sum of RGB)`);

  // The lifted codes, rounded once from the 16-bit luma
  const lifted = path.join(out, "lifted.gray"), fd = fs.openSync(lifted, "w");
  for (let i = 0; i < FRAMES; i++) {
    const b = fs.readFileSync(frameFile(i)), y16 = new Uint16Array(b.buffer, b.byteOffset, b.length / 2), code = Buffer.alloc(y16.length);
    for (let j = 0; j < y16.length; j++) code[j] = Math.round(255 * Math.sqrt(Math.min(1, y16[j] / 65535 * 255 / LIFT)));
    fs.writeSync(fd, code);
  }
  fs.closeSync(fd);
  if (process.env.FFMPEG) {
    execFileSync(process.env.FFMPEG, ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, "-framerate", "15", "-i", lifted,
      "-vf", "scale=in_range=pc:out_range=pc,format=yuvj420p",
      "-c:v", "libx264", "-preset", "veryslow", "-tune", "film", "-crf", String(process.env.CRF || 16), "-x264-params", "aq-mode=3",
      "-g", String(FRAMES), "-keyint_min", String(FRAMES), "-pix_fmt", "yuvj420p", "-color_range", "pc", "-movflags", "+faststart",
      path.join(out, "drape-loop.mp4")]);
    console.log("drape-loop.mp4", (fs.statSync(path.join(out, "drape-loop.mp4")).size / 1024).toFixed(0), "KB");
  }

  // The grain and the output dither: the original at 1:1 with both, against the dither-free copy without grain, at
  // t = 0 where the two fields are identical; the difference is what the original adds at the window's resolution
  const q = await open(1920, 1080, original, "full.html");
  const r = await open(1920, 1080, copy, "full-periodic.html");
  const withGrain = await q.evaluate(() => window.frameAt(0, .5));
  const without = await r.evaluate(() => window.frameAt(0, 0));
  const tile = await q.evaluate(([n, withGrain, without]) => {
    const [cw] = window.sizeOf();
    const c = document.createElement("canvas"); c.width = n; c.height = n;
    const g = c.getContext("2d"), img = g.createImageData(n, n);
    // a patch from a dark, even area left of centre
    const x0 = 200, y0 = 400;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const s = ((y0 + y) * cw + x0 + x) * 4, o = (y * n + x) * 4;
      const diff = ((withGrain[s] - without[s]) + (withGrain[s + 1] - without[s + 1]) + (withGrain[s + 2] - without[s + 2])) / 3;
      const base = Math.max(8, (without[s] + without[s + 1] + without[s + 2]) / 3);
      if (diff >= 0) { img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.min(255, Math.round(diff * 255 / Math.max(1, 255 - base))); }
      else { img.data[o] = img.data[o + 1] = img.data[o + 2] = 0; img.data[o + 3] = Math.min(255, Math.round(-diff * 255 / base)); }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }, [GRAIN, withGrain, without]);
  fs.writeFileSync(path.join(out, "drape-grain.png"), Buffer.from(tile.split(",")[1], "base64"));
  await q.evaluate(() => window.frameAt(0, .5));
  await q.screenshot({ path: path.join(out, "drape-original-1920.png") });
  await r.evaluate(() => window.frameAt(0, .5));
  await r.screenshot({ path: path.join(out, "drape-periodic-1920.png") });
  await r.evaluate(() => window.frameAt(60, .5));
  await r.screenshot({ path: path.join(out, "drape-periodic-1920-60s.png") });
  await q.evaluate(() => window.frameAt(60, .5));
  await q.screenshot({ path: path.join(out, "drape-original-1920-60s.png") });
  await browser.close();
  console.log("done");
})().catch(e => { console.error(e); process.exit(1); });
