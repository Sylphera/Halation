// Lists the keys that exist in locales/en.json but are missing (or empty) in the other locales,
// and keys the other locales have that en.json no longer uses.
// Usage: node app/scripts/i18n-missing.js [lang…]   (default: every locale except en). Exit code 1 if any is missing.
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "dist", "locales");
const read = lang => JSON.parse(fs.readFileSync(path.join(DIR, lang + ".json"), "utf8"));
const en = read("en");
const langs = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "en.json").map(f => f.slice(0, -5));
let missingTotal = 0;
for (const lang of langs) {
  const dict = read(lang);
  const missing = Object.keys(en).filter(k => typeof dict[k] !== "string" || !dict[k].trim());
  const extra = Object.keys(dict).filter(k => !(k in en));
  missingTotal += missing.length;
  console.log(`${lang}: ${missing.length} missing, ${extra.length} unused`);
  for (const k of missing) console.log(`  missing  ${k}  =  ${JSON.stringify(en[k])}`);
  for (const k of extra) console.log(`  unused   ${k}`);
}
process.exit(missingTotal ? 1 : 0);
