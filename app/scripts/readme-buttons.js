// README link buttons: one primary (Download) and three secondary pills, rendered once with the app font at 2×.
// Usage: node app/scripts/readme-buttons.js → docs/brand/readme/*.png. Dark fills read on GitHub's light and dark themes.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
const ROOT = path.join(__dirname, "..", ".."), DIST = path.join(ROOT, "app", "dist"), OUT = path.join(ROOT, "docs", "brand", "readme");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const url = f => "file://" + f.split(path.sep).join("/");
const WIN = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z"/></svg>';
const BUTTONS = [
  ["download", "primary", WIN + "Download for Windows"],
  ["changelog", "", "Changelog"],
  ["privacy", "", "Privacy"],
  ["license", "", "License"],
];
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${url(path.join(DIST, "fonts", "inter-latin-wght-normal.woff2"))})}
html,body{margin:0;background:transparent;font-family:Inter,sans-serif}
.b{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 22px;border-radius:22px;font-size:15.5px;font-weight:600;
  background:#121211;color:#eaeae6;border:1px solid #3e3e3a;box-sizing:border-box;margin:4px}
.b.primary{height:52px;padding:0 28px;border-radius:26px;font-size:17px;background:#f5f5f2;color:#050504;border-color:#b5b5af}
.b svg{width:17px;height:17px}
</style><body>${BUTTONS.map(([id, cls, text]) => `<span class="b ${cls}" id="${id}">${text}</span><br>`).join("")}</body>`;
(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(html); await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [id] of BUTTONS) {
    await page.locator("#" + id).screenshot({ path: path.join(OUT, id + ".png"), omitBackground: true });
    console.log("saved docs/brand/readme/" + id + ".png");
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
