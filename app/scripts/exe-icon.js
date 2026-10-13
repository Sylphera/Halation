// Checks that a Windows executable carries the app icon: reads the icon group from the .exe resources and
// compares its images with src-tauri/icons/icon.ico, byte by byte.
// Usage: node scripts/exe-icon.js <file.exe> [icon.ico] [--out extracted.ico]
// Exits with 1 when they differ. The workflow runs it on the portable executable before publishing.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RT_ICON = 3, RT_GROUP_ICON = 14;

function resources(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE file");
  const coff = pe + 4, sections = buf.readUInt16LE(coff + 2), optSize = buf.readUInt16LE(coff + 16);
  const opt = coff + 20, magic = buf.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const resRva = buf.readUInt32LE(dirs + 2 * 8);
  if (!resRva) throw new Error("the file has no resources");
  const table = [];
  for (let i = 0, s = opt + optSize; i < sections; i++, s += 40)
    table.push({ va: buf.readUInt32LE(s + 12), vsize: Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16)), raw: buf.readUInt32LE(s + 20) });
  const off = rva => { const s = table.find(s => rva >= s.va && rva < s.va + s.vsize); if (!s) throw new Error("bad RVA " + rva); return rva - s.va + s.raw; };
  const root = off(resRva);
  const entries = at => {
    const n = buf.readUInt16LE(at + 12) + buf.readUInt16LE(at + 14), out = [];
    for (let i = 0, e = at + 16; i < n; i++, e += 8) out.push({ id: buf.readUInt32LE(e), to: buf.readUInt32LE(e + 4) });
    return out;
  };
  const leaf = to => { const d = root + to; return buf.subarray(off(buf.readUInt32LE(d)), off(buf.readUInt32LE(d)) + buf.readUInt32LE(d + 4)); };
  // type → id → first language's data
  const out = {};
  for (const type of entries(root)) {
    if (!(type.to & 0x80000000)) continue;
    out[type.id] = {};
    for (const name of entries(root + (type.to & 0x7fffffff))) {
      const langs = name.to & 0x80000000 ? entries(root + (name.to & 0x7fffffff)) : [name];
      if (langs[0]) out[type.id][name.id] = leaf(langs[0].to);
    }
  }
  return out;
}

// The first icon group of the executable, rebuilt as an .ico file
function exeIcon(buf) {
  const res = resources(buf), groups = res[RT_GROUP_ICON], icons = res[RT_ICON] || {};
  const ids = Object.keys(groups || {}).map(Number).sort((a, b) => a - b);
  if (!ids.length) throw new Error("no icon group in the executable");
  const g = groups[ids[0]], n = g.readUInt16LE(4), images = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + i * 14;
    const data = icons[g.readUInt16LE(e + 12)];
    if (!data) throw new Error("icon image missing");
    images.push({ head: g.subarray(e, e + 12), data });
  }
  return images;
}

function readIco(buf) {
  const n = buf.readUInt16LE(4), images = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + i * 16, size = buf.readUInt32LE(e + 8), at = buf.readUInt32LE(e + 12);
    images.push({ head: buf.subarray(e, e + 12), data: buf.subarray(at, at + size) });
  }
  return images;
}

function writeIco(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let at = head.length;
  images.forEach((im, i) => { im.head.copy(head, 6 + i * 16); head.writeUInt32LE(im.data.length, 6 + i * 16 + 8); head.writeUInt32LE(at, 6 + i * 16 + 12); at += im.data.length; });
  return Buffer.concat([head, ...images.map(im => im.data)]);
}

const sha = b => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
const size = im => `${im.head[0] || 256}×${im.head[1] || 256}`;

if (require.main === module) {
  const args = process.argv.slice(2), oi = args.indexOf("--out");
  const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
  const [exe, ico = path.join(__dirname, "..", "src-tauri", "icons", "icon.ico")] = args;
  if (!exe) { console.error("usage: node scripts/exe-icon.js <file.exe> [icon.ico] [--out extracted.ico]"); process.exit(2); }
  const got = exeIcon(fs.readFileSync(exe)), want = readIco(fs.readFileSync(ico));
  if (out) fs.writeFileSync(out, writeIco(got));
  const a = got.map(im => `${size(im)} ${sha(im.data)}`).sort(), b = want.map(im => `${size(im)} ${sha(im.data)}`).sort();
  console.log(`${path.basename(exe)}: ${a.join(", ")}`);
  console.log(`${path.basename(ico)}: ${b.join(", ")}`);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  console.log(same ? "The executable carries the app icon." : "The executable icon differs from " + path.basename(ico));
  process.exit(same ? 0 : 1);
}

module.exports = { exeIcon, readIco, writeIco };
