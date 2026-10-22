// README hero: the brand mark and wordmark over a tilted, darkened mosaic of the README screenshots.
// Usage: node app/scripts/readme-hero.js → docs/brand/readme-hero.jpg (1600×640 at 2×).
// Run after `npm run shots` so the mosaic shows the current interface; Home is left out (it repeats the mark).
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
const ROOT = path.join(__dirname, "..", ".."), DIST = path.join(ROOT, "app", "dist");
const SHOTS = path.join(ROOT, "docs", "screenshots"), OUT = path.join(ROOT, "docs", "brand", "readme-hero.jpg");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const W = 1600, H = 640;
const url = f => "file://" + f.split(path.sep).join("/");
const word = fs.readFileSync(path.join(DIST, "index.html"), "utf8").match(/<svg class="word"[^>]*><path d="([^"]+)"/)[1];
// Row by row, five per row; the twelve tiles that show are all different tools, and the one repeat (Converter) sits in
// the opposite corner from the other.
const tiles = ["convert", "covertest", "grade", "stems", "library", "upscale", "framegrab", "interp", "downloader", "visualizer",
  "library", "grade", "visualizer", "removebg", "upscale", "covertest", "downloader", "stems", "convert", "interp"];
// Halation: a warm red fringe around the light parts, as on film
const halo = "filter:drop-shadow(0 0 2px rgba(255,236,220,.55)) drop-shadow(0 0 14px rgba(223,122,112,.55)) drop-shadow(0 0 48px rgba(223,122,112,.28))";
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${url(path.join(DIST, "fonts", "inter-latin-wght-normal.woff2"))})}
*{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000;font-family:Inter,sans-serif}
.grid{position:absolute;left:-260px;top:-330px;display:grid;grid-template-columns:repeat(5,440px);gap:22px;transform:rotate(-14deg)}
.grid img{display:block;width:440px;height:275px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08)}
.veil{position:absolute;inset:0;background:radial-gradient(42% 62% at 50% 50%,rgba(0,0,0,.94) 0,rgba(0,0,0,.86) 45%,rgba(0,0,0,.45) 80%,rgba(0,0,0,.35) 100%)}
.edges{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.7),transparent 25%,transparent 75%,rgba(0,0,0,.7))}
.brand{position:absolute;left:0;right:0;top:150px;display:flex;flex-direction:column;align-items:center}
.mark{width:120px;${halo}}.word{width:300px;margin-top:36px}
.tag{margin-top:24px;font-size:19px;letter-spacing:.01em;color:#b5b5af}
.grain{position:absolute;inset:0;opacity:.10;mix-blend-mode:screen}
</style><body>
<div class="grid">${tiles.map(t => `<img src="${url(path.join(SHOTS, t + ".jpg"))}">`).join("")}</div>
<div class="veil"></div><div class="edges"></div>
<div class="brand">
  <img class="mark" src="${url(path.join(DIST, "img", "halation-mark-source.png"))}">
  <svg class="word" viewBox="0 -80 760.2 82"><path fill="#f2f1ec" d="${word}"/></svg>
  <p class="tag">Focused tools for image, video and audio. Local, no account.</p>
</div>
<svg class="grain" width="${W}" height="${H}"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -.25"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>
</body>`;

(async () => {
  const tmp = path.join(require("os").tmpdir(), "halation-readme-hero.html");
  fs.writeFileSync(tmp, html);
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.goto(url(tmp));
  await page.waitForLoadState("load");
  const broken = await page.evaluate(async () => (await document.fonts.ready, [...document.images].filter(i => !i.naturalWidth).map(i => i.src)));
  if (broken.length) throw new Error("Missing images: " + broken.join(", "));
  await page.screenshot({ path: OUT, type: "jpeg", quality: 90 });
  await browser.close(); fs.rmSync(tmp);
  console.log("saved " + path.relative(ROOT, OUT));
})().catch(e => { console.error(e); process.exit(1); });
