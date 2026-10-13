#!/usr/bin/env node
// Stand-in for rife-ncnn-vulkan when the real one is not there: the same arguments (-i in -o out -m model -n frames
// -f pattern) and the same failures ("vkCreateInstance failed" without Vulkan, a missing model). It writes exactly
// -n frames (-g -1: on the CPU, which works without Vulkan); each is the input frame at the same point in time (a copy, not a new picture), so the frame count, the
// rate and the timing of the result can be checked. FAKE_RIFE_MS: time per frame (Cancel is tested with it).
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (val("-g") !== "-1" && process.env.VK_ICD_FILENAMES && !fs.existsSync(process.env.VK_ICD_FILENAMES)) {
    process.stderr.write("vkCreateInstance failed -9\ninvalid gpu device\n"); process.exit(255);
  }
  const model = val("-m", "rife-v2.3");
  if (!fs.existsSync(path.join(model, "flownet.param"))) { process.stderr.write(`fopen ${path.join(model, "flownet.param")} failed\n`); process.exit(255); }
  const dirIn = val("-i"), dirOut = val("-o"), pattern = val("-f", "%08d.png");
  const frames = fs.readdirSync(dirIn).filter(f => f.endsWith(".png")).sort();
  const n = +val("-n", String(frames.length * 2));
  const name = i => pattern.replace(/%0(\d)d/, (_, w) => String(i).padStart(+w, "0"));
  const ms = +(process.env.FAKE_RIFE_MS || 0);
  fs.mkdirSync(dirOut, { recursive: true });
  for (let i = 0; i < n; i++) {
    const src = frames[Math.min(frames.length - 1, Math.floor(i * frames.length / n))];
    fs.copyFileSync(path.join(dirIn, src), path.join(dirOut, name(i + 1)));
    if (ms) await sleep(ms);
  }
})();
