// Records the original Halation's Drape (its own drape.js, latest main) for the native beta's Home loop, as Java
// allowed on 2026-10-21: the original code is used only here, to render and adjust frames; the beta ships the frames.
//
// Seamless loop: the copy used here makes the Drape's time periodic. Each time-dependent noise lookup moves on a
// circle through the noise volume (time axis plus a small offset across) at the original speed, and the diagonal
// slide becomes a wide circle at the original speed; at t = 0 both start like the original. Frame PERIOD equals frame 0.
//
// Writes (in <out dir>):
//   drape-loop.bin   FRAMES JPEG frames of 320 x 180, 15 per field second: "HDL1", count (u32 LE), the byte length
//                    of each frame (u32 LE), then the frames. No grain.
//   drape-grain.png  256 x 256 RGBA tile of the stationary film grain (signed: white adds, black takes away)
//   drape-original-1920.png, drape-periodic-1920.png  the unmodified and the periodic Drape at t = 0, full size
// Usage: node record.js <dist dir of the original> <out dir>   (CHROME and NODE_PATH as for the reference shots)
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const [, , dist, out] = process.argv;
const PERIOD = 120, FRAMES = 1800, W = 320, H = 180, GRAIN = 256, QUALITY = 0.9;

// The periodic copy of drape.js: exact replacements, each must match once
function periodic(src) {
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
    ["snoise(ax * .3 + 3.1, ay * .54 + 7.7, t * .6)", "snoise(ax * .3 + 3.1, ay * .54 + 7.7 + ly(t, .6), lz(t, .6))"]
  ];
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
window.jpegAt = (t, q) => { d.canvas.__drapeReview.setGrainStrength(0); d.sceneAt({ time: t }); return grab()[0].toDataURL("image/jpeg", q); };
window.sizeOf = () => { const c = document.querySelector("canvas"); return [c.width, c.height]; };
</script></body></html>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const original = path.join(dist, "drape.js"), copy = path.join(out, "drape-periodic.js");
  fs.writeFileSync(copy, periodic(fs.readFileSync(original, "utf8")));
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
  const jpegs = [];
  for (let i = 0; i < FRAMES; i++) {
    const url = await p.evaluate(([t, q]) => window.jpegAt(t, q), [i * PERIOD / FRAMES, QUALITY]);
    jpegs.push(Buffer.from(url.split(",")[1], "base64"));
  }
  const header = Buffer.alloc(8 + 4 * FRAMES);
  header.write("HDL1", 0, "ascii"); header.writeUInt32LE(FRAMES, 4);
  jpegs.forEach((j, i) => header.writeUInt32LE(j.length, 8 + 4 * i));
  fs.writeFileSync(path.join(out, "drape-loop.bin"), Buffer.concat([header, ...jpegs]));
  const sizes = jpegs.map(j => j.length);
  console.log(`frames ${FRAMES}, ${(sizes.reduce((a, b) => a + b) / 1024).toFixed(0)} KB, ${(Math.min(...sizes) / 1024).toFixed(1)}-${(Math.max(...sizes) / 1024).toFixed(1)} KB each`);

  // The grain: a 1:1 render with and without it at the same moment; the difference is the grain
  const q = await open(1920, 1080, original, "full.html");
  const tile = await q.evaluate(([n]) => {
    const withGrain = window.frameAt(0, .5), without = window.frameAt(0, 0), [cw] = window.sizeOf();
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
  }, [GRAIN]);
  fs.writeFileSync(path.join(out, "drape-grain.png"), Buffer.from(tile.split(",")[1], "base64"));
  await q.evaluate(() => window.frameAt(0, .5));
  await q.screenshot({ path: path.join(out, "drape-original-1920.png") });
  const r = await open(1920, 1080, copy, "full-periodic.html");
  await r.evaluate(() => window.frameAt(0, .5));
  await r.screenshot({ path: path.join(out, "drape-periodic-1920.png") });
  await r.evaluate(() => window.frameAt(60, .5));
  await r.screenshot({ path: path.join(out, "drape-periodic-1920-60s.png") });
  await q.evaluate(() => window.frameAt(60, .5));
  await q.screenshot({ path: path.join(out, "drape-original-1920-60s.png") });
  await browser.close();
  console.log("done");
})().catch(e => { console.error(e); process.exit(1); });
