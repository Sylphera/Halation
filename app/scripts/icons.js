// Source: docs/brand/source/halation-mark.svg, a hand-drawn vector stroke (Java, 2026-10-22).
// The transparent UI mark and the app icon (the mark on a #111111 rounded square) both come from it.
// Render each icon size directly from the master; never resize a small derivative.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const GLOBAL = execSync("npm root -g").toString().trim();
const { chromium } = require(path.join(GLOBAL, "playwright"));
const APP = path.join(__dirname, ".."), ROOT = path.join(APP, "..");
const ICONS = path.join(APP, "src-tauri", "icons"), DIST = path.join(APP, "dist");
const BRAND = path.join(ROOT, "docs", "brand"), IDENTITY = path.join(APP, "src-tauri", "windows", "identity", "Assets");
const SOURCE = path.join(BRAND, "source", "halation-mark.svg");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MARK_PNG = 512, MARK_SPAN = .62;
function ico(images) {
  const header=Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
  images.forEach(({size,png},i)=>{const at=6+i*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
  return Buffer.concat([header,...images.map(x=>x.png)]);
}
const rasterize=(page,svg,size)=>page.evaluate(async({svg,size})=>{const im=new Image();im.src="data:image/svg+xml;base64,"+btoa(svg);await im.decode();const c=document.createElement("canvas");c.width=c.height=size;const ctx=c.getContext("2d");ctx.imageSmoothingQuality="high";ctx.drawImage(im,0,0,size,size);return c.toDataURL("image/png").split(",")[1];},{svg,size}).then(b=>Buffer.from(b,"base64"));
(async()=>{
  const markSvg=fs.readFileSync(SOURCE,"utf8");
  const [vx,vy,vw,vh]=markSvg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  if(vw!==vh)throw Error("The mark's viewBox must be square");
  const art=markSvg.trim().replace(/^<svg[^>]*>/,"").replace(/<\/svg>$/,"");
  // The mark spans MARK_SPAN of the square, centred; the frame is the earlier icon's hairline.
  const k=+(1024*MARK_SPAN/vw).toFixed(4);
  const icon=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n<rect width="1024" height="1024" rx="228" fill="#111111"/>\n<rect x="4" y="4" width="1016" height="1016" rx="224" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="8"/>\n<g transform="translate(512 512) scale(${k}) translate(${-(vx+vw/2)} ${-(vy+vh/2)})">${art}</g>\n</svg>\n`;
  const browser=await chromium.launch({executablePath:CHROME}),images=new Map();let markPng;
  try { const page=await browser.newPage();
    for(const size of [16,24,32,44,48,50,64,128,150,256,512])images.set(size,await rasterize(page,icon,size));
    markPng=await rasterize(page,markSvg,MARK_PNG);
  } finally { await browser.close(); }
  for(const folder of [ICONS,path.join(DIST,"img"),BRAND]){
    fs.writeFileSync(path.join(folder,"halation-mark-source.png"),markPng);
    fs.writeFileSync(path.join(folder,"halation-mark.svg"),markSvg);
    fs.writeFileSync(path.join(folder,"halation-app-icon.svg"),icon);
  }
  for(const [file,size]of [["32x32.png",32],["64x64.png",64],["128x128.png",128],["128x128@2x.png",256],["icon.png",512],["halation-mark.png",256]])fs.writeFileSync(path.join(ICONS,file),images.get(size));
  const windows=ico([16,24,32,48,64,128,256].map(size=>({size,png:images.get(size)})));
  for(const file of ["icon.ico","halation-mark.ico"])fs.writeFileSync(path.join(ICONS,file),windows);
  for(const [file,size]of [["StoreLogo.png",50],["Square44x44Logo.png",44],["Square150x150Logo.png",150]])fs.writeFileSync(path.join(IDENTITY,file),images.get(size));
  fs.writeFileSync(path.join(DIST,"favicon.ico"),windows);
  console.log(JSON.stringify({source:SOURCE,markSize:MARK_PNG,iconSizes:[...images.keys()]}));
})().catch(e=>{console.error(e);process.exitCode=1;});
