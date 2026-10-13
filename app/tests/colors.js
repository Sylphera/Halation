// Fails if an interface stylesheet uses a colour that is not a token: every colour literal must live in dist/tokens.css.
// Checks .css files, <style> blocks and style="" attributes of the HTML pages, and the CSS that fontpicker.js injects.
// Usage: node app/tests/colors.js
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<!-)\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|cyan|magenta)\b(?=\s*[;}!,)])/g;
const sources = [];
for (const f of fs.readdirSync(DIST)) {
  const p = path.join(DIST, f), s = fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : "";
  if (f.endsWith(".css") && f !== "tokens.css") sources.push([f, s]);
  if (f.endsWith(".html")) {
    for (const m of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) sources.push([f + " <style>", m[1]]);
    for (const m of s.matchAll(/style="([^"]*)"/g)) sources.push([f + " style=", m[1]]);
  }
  if (f.endsWith(".js")) for (const m of s.matchAll(/style\.textContent\s*=\s*`([\s\S]*?)`/g)) sources.push([f + " css", m[1]]);
}
let bad = 0;
for (const [where, css] of sources) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/content:\s*"[^"]*"/g, "");
  for (const m of clean.matchAll(LITERAL)) {
    const line = clean.slice(0, m.index).split("\n").length;
    console.log(`FAIL ${where}:${line} colour literal ${m[0]}`); bad++;
  }
}
console.log(bad ? `\n${bad} colour literals outside tokens.css` : `OK   no colour literals outside tokens.css (${sources.length} style sources checked)`);
process.exit(bad ? 1 : 0);
