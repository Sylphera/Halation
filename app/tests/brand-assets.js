// Source/format/consumer checks, no screenshots or visual-approval claims.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{execSync}=require('child_process');
const {PNG}=require(path.join(execSync('npm root -g').toString().trim(),'pngjs'));
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),os=require('os');
const base=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(base,f),'utf8');
(async()=>{const server=serve(),browser=await launch();try{
 const source=PNG.sync.read(fs.readFileSync(path.join(base,'../docs/brand/source/halation.logo.png')));assert.equal(source.width,2048);assert.equal(source.height,682);
 const mark=PNG.sync.read(fs.readFileSync(path.join(base,'src-tauri/icons/halation-mark-source.png')));assert.equal(mark.width,573);assert.equal(mark.height,282);assert.equal(mark.data[3],0,'transparent mark canvas');
 const svg=read('src-tauri/icons/halation-app-icon.svg'),plain=read('src-tauri/icons/halation-mark.svg');assert(!plain.includes('<rect'));assert(svg.includes('#1a1a1c')&&svg.includes('#0b0b0c'));
 const page=await browser.newPage();await page.setContent(svg);const geometry=await page.locator('image').evaluate(e=>({x:e.x.baseVal.value,y:e.y.baseVal.value,w:e.width.baseVal.value,h:e.height.baseVal.value}));assert(Math.abs(geometry.x+geometry.w/2-512)<.001);assert(Math.abs(geometry.y+geometry.h/2-512)<.001);assert(Math.abs(geometry.w/geometry.h-mark.width/mark.height)<1e-6);
 for(const [file,size]of [['32x32.png',32],['64x64.png',64],['128x128.png',128],['128x128@2x.png',256],['icon.png',512],['halation-mark.png',256]]){const p=PNG.sync.read(fs.readFileSync(path.join(base,'src-tauri/icons',file)));assert.equal(p.width,size);assert.equal(p.height,size);assert.equal(p.data[((Math.floor(size/2)*size)+Math.floor(size/2))*4+3],255,'square icon retains opaque background');}
 const ico=fs.readFileSync(path.join(base,'src-tauri/icons/icon.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);assert.deepEqual(ico,fs.readFileSync(path.join(base,'dist/favicon.ico')));
 for(const f of ['dist/index.html','dist/shell.js'])assert(read(f).includes('img/halation-mark.svg')&&!read(f).includes('img/halation-logo.svg'));
 const app=await openApp(browser,server,createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-brand-assets-'))));await app.tab('visualizer');await app.appReady('visualizer');
 const f=app.vFrame(),sidebar=await app.page.locator('.rail .tab[data-tab="visualizer"] .i').evaluate(e=>e.innerHTML),empty=await f.locator('#emptyStage .big .i').evaluate(e=>e.innerHTML);assert.equal(empty,sidebar,'exact shared sidebar icon paths');assert.equal(await f.locator('#emptyStage img').count(),0);
 await app.tab('home');await app.page.locator('.hero-mark img').evaluate(i=>i.decode());await app.page.evaluate(()=>__shell.welcome());await app.page.locator('#welcome .wl-mark').evaluate(i=>i.decode());
 const imgs=await app.page.locator('.hero-mark img,#welcome .wl-mark').evaluateAll(es=>es.map(i=>({w:i.naturalWidth,h:i.naturalHeight,src:i.getAttribute('src')})));for(const i of imgs){assert.equal(i.w,573);assert.equal(i.h,282);assert.equal(i.src,'img/halation-mark.svg');}
 assert.deepEqual(app.errors,[]);console.log('OK supplied PNG symbol separated from text; independent transparent mark and historical square icon; PNG/ICO formats; Home/Welcome; exact shared Visualizer icon');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
