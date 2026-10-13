// Source: the user's full-resolution halation.logo.png. Keep the transparent
// brand mark independent of the app icon's historical dark square background.
// Render each icon size directly from the master; never resize a small derivative.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const GLOBAL = execSync("npm root -g").toString().trim();
const { PNG } = require(path.join(GLOBAL, "pngjs"));
const { chromium } = require(path.join(GLOBAL, "playwright"));
const APP = path.join(__dirname, ".."), ROOT = path.join(APP, "..");
const ICONS = path.join(APP, "src-tauri", "icons"), DIST = path.join(APP, "dist");
const BRAND = path.join(ROOT, "docs", "brand"), IDENTITY = path.join(APP, "src-tauri", "windows", "identity", "Assets");
const SOURCE = path.join(BRAND, "source", "halation.logo.png");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
function extractSymbol(source) {
  const { width:w, height:h, data } = PNG.sync.read(source);
  const light = (x,y) => Math.max(...data.subarray((y*w+x)*4,(y*w+x)*4+3));
  const columns = Array.from({ length:w }, (_,x) => { for(let y=0;y<h;y++)if(light(x,y)>64)return true;return false; });
  const first = columns.indexOf(true); if(first<0)throw Error("No symbol in source");
  let gap=0,separator=-1;
  for(let x=first;x<w;x++){gap=columns[x]?0:gap+1;if(gap===24){separator=x-12;break;}}
  if(separator<0||separator>w/2)throw Error("Cannot separate symbol from wordmark");
  let x0=w,y0=h,x1=0,y1=0;
  for(let y=0;y<h;y++)for(let x=0;x<separator;x++)if(light(x,y)>32){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  // Preserve two native pixels around the antialiased contour.
  x0=Math.max(0,x0-2);y0=Math.max(0,y0-2);x1=Math.min(separator-1,x1+2);y1=Math.min(h-1,y1+2);
  const png = new PNG({ width:x1-x0+1, height:y1-y0+1 });
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const src=(y*w+x)*4,dst=((y-y0)*png.width+x-x0)*4;
    const alpha=Math.max(0,Math.min(1,(light(x,y)-8)/222));
    for(let c=0;c<3;c++)png.data[dst+c]=alpha?Math.min(255,Math.round(data[src+c]/alpha)):0;
    png.data[dst+3]=Math.round(alpha*255);
  }
  return { png:PNG.sync.write(png), width:png.width, height:png.height, crop:[x0,y0,png.width,png.height], sourceSize:[w,h] };
}
function ico(images) {
  const header=Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
  images.forEach(({size,png},i)=>{const at=6+i*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
  return Buffer.concat([header,...images.map(x=>x.png)]);
}
(async()=>{
  const mark=extractSymbol(fs.readFileSync(SOURCE));
  const image=`data:image/png;base64,${mark.png.toString("base64")}`;
  const markSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="${mark.width}" height="${mark.height}" viewBox="0 0 ${mark.width} ${mark.height}"><image width="${mark.width}" height="${mark.height}" href="${image}"/></svg>\n`;
  const width=1024*.78,height=width*mark.height/mark.width;
  const icon=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1a1c"/><stop offset="1" stop-color="#0b0b0c"/></linearGradient></defs>\n<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>\n<rect x="4" y="4" width="1016" height="1016" rx="224" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="8"/>\n<image x="${(1024-width)/2}" y="${(1024-height)/2}" width="${width}" height="${height}" href="${image}"/>\n</svg>\n`;
  for(const folder of [ICONS,path.join(DIST,"img"),BRAND]){
    fs.writeFileSync(path.join(folder,"halation-mark-source.png"),mark.png);
    fs.writeFileSync(path.join(folder,"halation-mark.svg"),markSvg);
    fs.writeFileSync(path.join(folder,"halation-app-icon.svg"),icon);
  }
  const browser=await chromium.launch({executablePath:CHROME}),images=new Map();
  try { const page=await browser.newPage();
    for(const size of [16,24,32,44,48,50,64,128,150,256,512]){
      const png=await page.evaluate(async({svg,size})=>{const im=new Image();im.src="data:image/svg+xml;base64,"+btoa(svg);await im.decode();const c=document.createElement("canvas");c.width=c.height=size;const ctx=c.getContext("2d");ctx.imageSmoothingQuality="high";ctx.drawImage(im,0,0,size,size);return c.toDataURL("image/png").split(",")[1];},{svg:icon,size});
      images.set(size,Buffer.from(png,"base64"));
    }
  } finally { await browser.close(); }
  for(const [file,size]of [["32x32.png",32],["64x64.png",64],["128x128.png",128],["128x128@2x.png",256],["icon.png",512],["halation-mark.png",256]])fs.writeFileSync(path.join(ICONS,file),images.get(size));
  const windows=ico([16,24,32,48,64,128,256].map(size=>({size,png:images.get(size)})));
  for(const file of ["icon.ico","halation-mark.ico"])fs.writeFileSync(path.join(ICONS,file),windows);
  for(const [file,size]of [["StoreLogo.png",50],["Square44x44Logo.png",44],["Square150x150Logo.png",150]])fs.writeFileSync(path.join(IDENTITY,file),images.get(size));
  fs.writeFileSync(path.join(DIST,"favicon.ico"),windows);
  fs.writeFileSync(path.join(BRAND,"source","extraction.json"),JSON.stringify({source:"halation.logo.png",...Object.fromEntries(Object.entries(mark).filter(([k])=>k!=="png")),appIcon:{canvas:1024,symbolWidth:width,symbolHeight:height,extraOffset:0},background:"16d8e6c:app/src-tauri/icons/halation-icon.svg"},null,2)+"\n");
  console.log(JSON.stringify({source:SOURCE,crop:mark.crop,sourceSize:mark.sourceSize,iconSizes:[...images.keys()],extraOffset:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
