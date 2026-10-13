#!/usr/bin/env node
// Stand-in for upscayl-bin when the real one is not built: same arguments and the same stderr lines
// ("0.00%" … "100.00%", "vkCreateInstance failed" without Vulkan). The image is scaled with FFmpeg, and like the real
// one it drops the last column / row of an odd side.
const { execFileSync } = require("child_process");
const fs = require("fs");

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  process.stderr.write("🚀 Starting Upscayl - Copyright © 2024\n");
  if (process.env.VK_ICD_FILENAMES && !fs.existsSync(process.env.VK_ICD_FILENAMES)) {
    process.stderr.write("vkCreateInstance failed -9\n🚨 Error: Invalid GPU Device\n"); process.exit(255);
  }
  const model = `${val("-m")}/${val("-n")}.param`;
  if (!fs.existsSync(model)) { process.stderr.write(`fopen ${model} failed\n`); process.exit(255); }
  for (let p = 0; p <= 100; p += 20) { process.stderr.write(`${p.toFixed(2)}%\n`); await sleep(/slow/.test(val("-i")) ? 800 : 40); }
  const s = +val("-s") || 4;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", val("-i"), "-vf", `crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,scale=iw*${s}:ih*${s}:flags=neighbor`, val("-o")]);
  process.stderr.write("\n🙌 Upscayled Successfully!\n");
})();
