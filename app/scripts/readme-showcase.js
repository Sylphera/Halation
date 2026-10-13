// README images built from the screenshots: the promo (stacked tool windows and what the workspace shares) and the
// showcase (every tool as a card, cropped with the boxes shots.js records in docs/screenshots/panels.json).
// Usage: node app/scripts/readme-showcase.js → docs/screenshots/promo.jpg and showcase.jpg (2×). Run after `npm run shots`.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
const ROOT = path.join(__dirname, "..", ".."), DIST = path.join(ROOT, "app", "dist"), SHOTS = path.join(ROOT, "docs", "screenshots");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PANELS = JSON.parse(fs.readFileSync(path.join(SHOTS, "panels.json"), "utf8"));
const url = f => "file://" + f.split(path.sep).join("/");

/* ===== tools ===== */
// Order and icons follow modules.js. fy: vertical focus of the crop when the panel is taller than its tile (0 top, 1 bottom).
// box: the part of the screenshot that presents the tool, in CSS pixels, when the whole main panel is too large or too
// empty for a card (the media and the controls that act on it); without it, the panel from panels.json.
const TOOLS = {
  downloader: { icon: "download", name: "Downloader", line: "Video, audio and artwork from a link.", box: { x: 322, y: 321, width: 440, height: 249 } },
  convert: { icon: "repeat", name: "Converter", line: "Media, documents and PDF pages.", box: { x: 905, y: 58, width: 480, height: 272 } },
  stems: { icon: "mic-vocal", name: "Vocal Remover", line: "Vocals, instrumental or four stems.", fy: .35, box: { x: 398, y: 248, width: 600, height: 340 } },
  visualizer: { icon: "audio-lines", name: "Audio Visualizer", line: "Audio-reactive videos in any format.", fy: .2, box: { x: 250, y: 100, width: 800, height: 430 } },
  grade: { icon: "palette", name: "Grade", line: "Looks, layers and effects for images.", fy: .4 },
  covertest: { icon: "gallery-horizontal-end", name: "Cover Test", line: "Your cover where it will be seen.", fy: .3, box: { x: 740, y: 215, width: 547, height: 310 } },
  removebg: { icon: "wand-sparkles", name: "Background Remover", line: "Subjects cut out in a click.", fy: .3, box: { x: 354, y: 118, width: 612, height: 347 } },
  upscale: { icon: "image-up", name: "Upscale", line: "Sharper images and video, ×2 or ×4.", fy: .45, box: { x: 400, y: 200, width: 500, height: 283 } },
  interp: { icon: "gauge", name: "AI Interpolate", line: "Smoother motion, higher frame rates.", fy: .3, box: { x: 165, y: 64, width: 740, height: 419 } },
  framegrab: { icon: "camera", name: "Frame Capture", line: "Exact frames at full resolution.", fy: .3, box: { x: 100, y: 380, width: 1060, height: 600 } },
  library: { icon: "library", name: "Library", line: "Exports, tags and favourites together.", fy: .1, box: { x: 330, y: 200, width: 560, height: 317 } },
};

/* ===== crop ===== */
// Background CSS that covers a w×h tile with the tool's panel, from its 1600×1000 screenshot.
function crop(id, w, h) {
  const p = TOOLS[id].box || PANELS[id], k = Math.max(w / p.width, h / p.height), fy = TOOLS[id].fy ?? .5;
  const x = -(p.x * k) - (p.width * k - w) / 2, y = -(p.y * k) - (p.height * k - h) * fy;
  return `background:url(${url(path.join(SHOTS, id + ".jpg"))}) ${x}px ${y}px/${1600 * k}px ${1000 * k}px no-repeat`;
}

/* ===== page ===== */
const page = (W, H, body, css) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${url(path.join(DIST, "fonts", "inter-latin-wght-normal.woff2"))})}
*{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000;font-family:Inter,sans-serif;color:#f5f5f2}
.field{position:absolute;inset:-60px;background:url(${url(path.join(SHOTS, "home.jpg"))}) center/cover;filter:blur(20px) brightness(.85)}
.shade{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 0%,rgba(0,0,0,.1),rgba(0,0,0,.65))}
header{position:absolute;left:64px;right:64px;top:50px;display:flex;align-items:center;gap:22px}
header img{width:96px}h1{font-size:44px;font-weight:650;letter-spacing:-.015em}
header p{margin-left:auto;font-size:21px;color:#b5b5af;text-align:right;line-height:1.45}
.tile{position:relative;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.10);background:#050504;box-shadow:0 24px 50px rgba(0,0,0,.5)}
.label{display:grid;grid-template-columns:30px 1fr;column-gap:10px;align-items:center}
.label svg{width:24px;height:24px;stroke:#a3a8dc;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.label b{font-weight:600}.label span{grid-column:1/3;margin-top:4px;color:#b5b5af;line-height:1.35}
${css}</style><body><div class="field"></div><div class="shade"></div>
<script src="${url(path.join(DIST, "icons.js"))}"></script>${body}
<script>for (const i of document.querySelectorAll("[data-i]")) i.outerHTML = window.icon(i.dataset.i);</script></body>`;
const label = (id, cls = "") => `<div class="label ${cls}"><i data-i="${TOOLS[id].icon}"></i><b>${TOOLS[id].name}</b><span>${TOOLS[id].line}</span></div>`;
const header = (title, sub) => `<header><img src="${url(path.join(DIST, "img", "halation-mark-source.png"))}"><h1>${title}</h1><p>${sub}</p></header>`;

/* ===== promo ===== */
// Four tool windows stacked in perspective under a light beam, and the workspace as a numbered list: what the tools
// share, since the showcase already presents the tools themselves.
const WORD = fs.readFileSync(path.join(DIST, "index.html"), "utf8").match(/<svg class="word"[^>]*><path d="([^"]+)"/)[1];
const FEATURES = [["Home", "drop media · recent files"], ["Send to…", "results move between tools"], ["Cutout · Crop", "shared editors"],
  ["Library", "exports · tags · favourites"], ["Presets · looks", "plain local files"], ["GPU or CPU", "uses what the PC has"],
  ["Engines on demand", "downloaded when needed"], ["Updates in place", "your data stays"], ["Local", "no account · no watermark"]];
function promo() {
  const W = 1600, H = 1000, stack = ["library", "grade", "framegrab", "visualizer"];
  const rows = FEATURES.map(([t, s], i) => `<li><span class="n">${String(i + 1).padStart(2, "0")}</span><b>${t}</b><i>${s}</i></li>`).join("");
  const body = `<div class="beam"></div><div class="scene">${stack.map((id, i) => `<div class="win" style="left:${130 + i * 70}px;top:${i * 70}px;` +
    `background-image:url(${url(path.join(SHOTS, id + ".jpg"))});filter:saturate(.8) brightness(${[.45, .6, .78, 1][i]})"></div>`).join("")}</div>
  <div class="reg"></div>
  <div class="side"><svg class="word" viewBox="0 -80 760.2 82"><path fill="#eceae4" d="${WORD}"/></svg><p class="k">ONE LOCAL WORKSPACE</p><ul>${rows}</ul>
  <p class="foot">Eleven tools for image, video and audio<br>Free for Windows 10 and 11 · installer or portable</p></div>
  <svg class="grain" width="${W}" height="${H}"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/>` +
    `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.5 -.3"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  return [W, H, page(W, H, body, `
.field,.shade{display:none}body{background:#030304;color:#eceae4}
.beam{position:absolute;left:300px;top:-260px;width:240px;height:1500px;transform:rotate(22deg);mix-blend-mode:screen;filter:blur(20px);
  background:linear-gradient(90deg,transparent,rgba(70,90,255,.25),rgba(150,170,255,.5),rgba(70,90,255,.25),transparent)}
.scene{position:absolute;left:-70px;top:110px;width:1000px;height:800px;perspective:1800px}
.win{position:absolute;width:800px;height:500px;border-radius:12px;background:center/cover;transform-origin:left center;
  transform:rotateY(28deg) rotateX(6deg) rotateZ(-2deg);box-shadow:0 0 0 1px rgba(255,255,255,.13),0 30px 90px rgba(0,0,0,.85)}
.reg{position:absolute;left:40px;top:40px;width:22px;height:22px;border:1px solid rgba(255,255,255,.3);border-radius:50%}
.reg:before,.reg:after{content:"";position:absolute;background:rgba(255,255,255,.3)}
.reg:before{left:10px;top:-8px;width:1px;height:36px}.reg:after{top:10px;left:-8px;height:1px;width:36px}
.side{position:absolute;left:965px;top:70px;width:575px;height:870px}.word{width:320px;display:block}
.k,.n,li i,.foot{font-family:"DejaVu Sans Mono",monospace}
.k{font-size:14px;letter-spacing:.32em;color:#8f93c8;margin:30px 0 18px}
ul{list-style:none;border-top:1px solid #2a2a2e}li{display:grid;grid-template-columns:50px 1fr auto;align-items:baseline;padding:14px 0;border-bottom:1px solid #1d1d21}
li .n{color:#6d6f86;font-size:15px}li b{font-size:24px;font-weight:560;letter-spacing:-.01em}li i{font-style:normal;font-size:13px;color:#8a8a86}
.foot{position:absolute;left:0;bottom:0;font-size:13px;color:#8a8a86;line-height:1.7}
.grain{position:absolute;inset:0;opacity:.13;mix-blend-mode:screen}`)];
}

/* ===== showcase ===== */
// Every tool: the panel on top, the label underneath, and one card for Send to…
function showcase() {
  const W = 1600, H = 1160;
  const cards = Object.keys(TOOLS).map(id => `<div class="tile card"><div class="thumb" style="${crop(id, 353, 200)}"></div>${label(id)}</div>`).join("");
  const body = header("Eleven tools. One local workspace.", "Image, video and audio on your PC.<br>No account, no watermark.") +
    `<div class="grid">${cards}<div class="tile card more"><b>Send to…</b><span>Results move between tools without leaving the app. Heavy engines download only when a tool needs them.</span></div></div>`;
  return [W, H, page(W, H, body, `
.grid{position:absolute;left:64px;right:64px;top:166px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.card{background:rgba(11,11,10,.85)}.thumb{height:200px;border-bottom:1px solid rgba(255,255,255,.07)}
.card .label{padding:16px 18px 20px}.card .label b{font-size:23px}.card .label span{font-size:17.5px}
.more{display:flex;flex-direction:column;justify-content:center;gap:12px;padding:26px;background:rgba(163,168,220,.10);border-color:rgba(163,168,220,.35)}
.more b{font-size:26px;font-weight:600}.more span{font-size:19px;color:#d7d7d2;line-height:1.5}`)];
}

(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
  for (const [name, build] of [["promo", promo], ["showcase", showcase]]) {
    const [W, H, html] = build(), tmp = path.join(require("os").tmpdir(), `halation-readme-${name}.html`);
    fs.writeFileSync(tmp, html);
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await tab.goto(url(tmp)); await tab.waitForLoadState("load");
    const missing = await tab.evaluate(async () => (await document.fonts.ready, document.querySelectorAll("[data-i]").length));
    if (missing) throw new Error(missing + " icons were not found");
    await tab.screenshot({ path: path.join(SHOTS, name + ".jpg"), type: "jpeg", quality: 90 });
    await tab.close(); fs.rmSync(tmp);
    console.log(`saved docs/screenshots/${name}.jpg`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
