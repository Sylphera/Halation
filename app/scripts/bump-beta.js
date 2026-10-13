// Increments the beta number (0.1.0-beta.N → 0.1.0-beta.N+1) in every place that holds the version
// and adds an empty section for it at the top of CHANGELOG.md. Run it before each release build.
// Usage: node app/scripts/bump-beta.js [--set <version>]
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const ROOT = path.join(APP, "..");
const conf = path.join(APP, "src-tauri", "tauri.conf.json");
const current = JSON.parse(fs.readFileSync(conf, "utf8")).version;
if (process.argv.slice(2).some(a => a !== "--set" && process.argv[process.argv.indexOf(a) - 1] !== "--set")) {
  console.error("Usage: node app/scripts/bump-beta.js [--set <version>]"); process.exit(1);
}
const si = process.argv.indexOf("--set");
let next = si >= 0 ? process.argv[si + 1] : null;
if (!next) {
  const m = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(current);
  if (!m) { console.error(`Not a beta version: ${current}. Use --set <version>.`); process.exit(1); }
  next = `${m[1]}-beta.${+m[2] + 1}`;
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(next)) { console.error("Invalid version: " + next); process.exit(1); }

const edit = (file, fn) => { const p = path.join(...file); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); console.log("updated " + path.relative(ROOT, p)); };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
edit([APP, "src-tauri", "tauri.conf.json"], s => s.replace(`"version": "${current}"`, `"version": "${next}"`));
edit([APP, "package.json"], s => s.replace(`"version": "${current}"`, `"version": "${next}"`));
// only the root and packages[""] entries: dependencies can share the version number
edit([APP, "package-lock.json"], s => s.replace(`"version": "${current}"`, `"version": "${next}"`).replace(`"version": "${current}"`, `"version": "${next}"`));
edit([APP, "src-tauri", "Cargo.toml"], s => s.replace(new RegExp(`^version = "${esc(current)}"`, "m"), `version = "${next}"`));
edit([APP, "src-tauri", "Cargo.lock"], s => s.replace(new RegExp(`(name = "halation"\\r?\\nversion = )"${esc(current)}"`), `$1"${next}"`));
edit([ROOT, "CHANGELOG.md"], s => s.includes(`## ${next}\n`) ? s : s.replace(/\n## /, `\n## ${next}\n\n- \n\n## `));
console.log(`${current} → ${next}. Write the changes under "## ${next}" in CHANGELOG.md.`);
