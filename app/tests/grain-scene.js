// Audit live-to-offline scene parity; no forced variant, crop, CSS zoom, or changed visual parameters.
const fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep,until}=require('./common');const {createHost}=require('./host');
const {prepareTimeline,stepTimeline,waitPresentation}=require('./visual-review');
const OUT=process.env.GRAIN_OUT||'/tmp/halation-scene-audit';fs.mkdirSync(OUT,{recursive:true});
let failures=0;const ok=(v,s)=>{console.log((v?'OK   ':'FAIL ')+s);if(!v)failures++;};
async function dimensions(page){return page.evaluate(()=>{
 const info=s=>{const e=document.querySelector(s),c=getComputedStyle(e),b=e.getBoundingClientRect();return {css:{width:b.width,height:b.height,x:b.x,y:b.y},buffer:{width:e.width,height:e.height},transform:c.transform,zoom:c.zoom,objectFit:c.objectFit,backgroundSize:c.backgroundSize};};
 return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualScale:visualViewport.scale},bodyTransform:getComputedStyle(document.body).transform,htmlTransform:getComputedStyle(document.documentElement).transform,atmo:info('.atmo'),grain:info('.grain canvas'),variant:window.__atmo.variant};
});}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'halation-scene-')),host=createHost(root),server=serve(),browser=await launch();
 const wrapper={newPage:async o=>{const p=await browser.newPage(o);await p.addInitScript(()=>window.__halGrainTest=true);return p;}};
 const reports=[];
 for(const config of [{width:1280,height:800,scale:1},{width:1480,height:940,scale:1},{width:1280,height:800,scale:2},{width:1536,height:864,scale:1.25}]){
  const app=await openApp(wrapper,server,host,{...config,motion:true}),{page}=app;await sleep(1200);
  await until(()=>page.evaluate(()=>!window.__motion.busy()),5000);
  await waitPresentation(page);
  const box=await page.locator('.hero .logo').boundingBox();
  const clock=await prepareTimeline(page);
  const preparedBox=await page.locator('.hero .logo').boundingBox();
  ok(['width','height','x','y'].every(k=>Math.abs(box[k]-preparedBox[k])<.1),'Clock preparation preserves live UI geometry without finishing/resetting animations');
  const live=await page.evaluate(()=>window.__atmo.grainTest.scene()),before=await dimensions(page);
  // Start the deterministic timeline at the actual most recently drawn phase, retaining all scene uniforms.
  const offline=await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),live),after=await dimensions(page);
  ok(Math.abs(live.time-offline.time)<1e-8&&JSON.stringify({...live,time:0})===JSON.stringify({...offline,time:0}),'Live and offline background retain identical shader state '+JSON.stringify(config));
  ok(JSON.stringify(before)===JSON.stringify(after),'Offline preparation leaves CSS, physical dimensions, DPR and transforms unchanged');
  ok(before.atmo.css.width===config.width&&before.atmo.css.height===config.height&&live.width===Math.round(config.width*.6)&&live.height===Math.round(config.height*.6),'CSS viewport and background render scale are consistent');
  ok(before.grain.buffer.width===Math.round(config.width*config.scale)&&before.grain.buffer.height===Math.round(config.height*config.scale),'Only grain backing resolution scales with DPR');
  ok(before.atmo.transform==='none'&&before.bodyTransform==='none'&&before.htmlTransform==='none'&&before.viewport.visualScale===1,'No ancestor transform, CSS zoom or cover scale changes the background');
  const shot=path.join(OUT,`scene-${config.width}-${config.scale}.png`);
  await page.screenshot({path:shot});
  const meta=JSON.parse(fs.readFileSync(shot+'.review.json'));
  ok(meta.kind==='full-live-viewport'&&meta.pixels.width===Math.round(config.width*config.scale)&&meta.pixels.height===Math.round(config.height*config.scale),'Shared screenshot contract records native pixels and live geometry');
  if(config.scale===1){
   const detail=path.join(OUT,`detail-${config.width}.png`);await page.locator('.rail').screenshot({path:detail});
   ok(fs.existsSync(detail+'.context.png')&&JSON.parse(fs.readFileSync(detail+'.review.json')).kind==='diagnostic-detail','Element details carry a complete native-context screenshot');
  }
  const t1=await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),{...live,time:live.time+1/60});
  ok(Math.abs(t1.time-live.time-1/60)<1e-8&&t1.width===live.width&&JSON.stringify(t1.variant)===JSON.stringify(live.variant),'Exact frame step advances time, preserving composition parameters');
  await stepTimeline(page,clock,60);
  const steppedBox=await page.locator('.hero .logo').boundingBox();
  ok(Math.abs(box.width-steppedBox.width)<.01&&Math.abs(box.height-steppedBox.height)<.01,'Stepped CSS/GSAP timeline keeps native layout scale');
  await page.setViewportSize({width:config.width+160,height:config.height+80});
  ok(await until(async()=>{const s=await page.evaluate(()=>window.__atmo.grainTest.scene());return s.cssWidth===config.width+160&&s.cssHeight===config.height+80;},3000),'Resize updates renderer uniforms and backing dimensions');
  reports.push({config,live,offline,before,after,errors:app.errors});ok(!app.errors.length,'No page errors');await page.close();
 }
 fs.writeFileSync(path.join(OUT,'scene-audit.json'),JSON.stringify({reports,failures},null,2));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
