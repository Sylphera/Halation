// Render the live app's actual scene at exact 1/60 s steps, retaining viewport, DPR, variant and shader scale.
const fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep}=require('./common');const {createHost}=require('./host');
const {prepareTimeline,stepTimeline,waitPresentation,encodeVideo}=require('./visual-review');
const OUT=process.env.GRAIN_OUT||'/tmp/halation-grain-review',FPS=60,FRAMES=600;
const windowConfig=require('../src-tauri/tauri.conf.json').app.windows[0];
const replay=process.env.REVIEW_SCENE?JSON.parse(fs.readFileSync(process.env.REVIEW_SCENE,'utf8')):null;
const width=Number(replay?.geometry.viewport.width||process.env.GRAIN_WIDTH||windowConfig.width),height=Number(replay?.geometry.viewport.height||process.env.GRAIN_HEIGHT||windowConfig.height),scale=Number(replay?.geometry.viewport.dpr||process.env.GRAIN_DPR||1);
const source=process.env.REVIEW_SOURCE||path.join(__dirname,'../dist/atmosphere.js');
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'halation-grain-render-')),host=createHost(root),server=serve(),browser=await launch();
 const wrapper={newPage:async o=>{const p=await browser.newPage(o);p.__reviewSources={'atmosphere.js':require('crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex')};await p.addInitScript(v=>{window.__halGrainTest=true;if(v)sessionStorage.setItem('hal.atmo',JSON.stringify(v));},replay?.liveScene.variant||null);if(process.env.REVIEW_SOURCE)await p.route('**/atmosphere.js',r=>r.fulfill({path:source,contentType:'application/javascript'}));return p;}};
 const app=await openApp(wrapper,server,host,{width,height,scale,motion:true});const {page}=app;
 await page.mouse.move(1100,770);await sleep(700);
 await page.waitForFunction(()=>!window.__motion.busy());
 await waitPresentation(page);
 const clock=await prepareTimeline(page,replay?.uiPhase);
 const observedScene=await page.evaluate(()=>window.__atmo.grainTest.scene());
 const liveScene={...observedScene,time:replay?.liveScene.time??observedScene.time};
 const grainTime=replay?.grainTime??(await page.evaluate(()=>window.__atmo.grainTest.metrics())).time;
 const backgroundFPS={home:30,tool:10,mix:60}[liveScene.mode];
 const sceneAtStart=await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),liveScene);
 if(Math.abs(sceneAtStart.time-liveScene.time)>1e-8||JSON.stringify({...sceneAtStart,time:0})!==JSON.stringify({...liveScene,time:0}))throw Error('Offline preparation changed the live scene');
 const geometry=await page.evaluate(()=>{const c=document.querySelector('.atmo'),b=c.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualScale:visualViewport.scale},canvasCSS:{x:b.x,y:b.y,width:b.width,height:b.height},canvasBacking:{width:c.width,height:c.height},transform:getComputedStyle(c).transform,variant:window.__atmo.variant};});
 const dir=path.join(OUT,'frames');fs.mkdirSync(dir,{recursive:true});
 const clip={x:0,y:0,width,height};
 const checkpoints={0:'home-0.png',360:'home-6.png',599:'home-10.png'};
 const samples=[];
 fs.writeFileSync(path.join(OUT,'scene.json'),JSON.stringify({geometry,liveScene,grainTime,uiPhase:clock.css},null,2));
 for(let i=0;i<FRAMES;i++){
   await stepTimeline(page,clock,i,FPS);
   const backgroundTime=liveScene.time+Math.floor(i*backgroundFPS/FPS)/backgroundFPS;
   if(i===0||Math.floor(i*backgroundFPS/FPS)!==Math.floor((i-1)*backgroundFPS/FPS))await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),{...liveScene,time:backgroundTime});
   const pixels=await page.evaluate(t=>window.__atmo.grainTest.renderAt(t,true),grainTime+i/FPS);
   // readPixels synchronizes production GL draw before the screenshot; no elapsed recorder time enters the shader.
   const alpha=pixels.filter((_,k)=>k%4===3);samples.push({frame:i,time:i/FPS,backgroundTime,meanAlpha:alpha.reduce((s,a)=>s+a,0)/alpha.length,maxAlpha:Math.max(...alpha)});
   if(checkpoints[i])await page.screenshot({path:path.join(OUT,checkpoints[i]),animations:'allow'});
   await page.screenshot({path:path.join(dir,String(i).padStart(4,'0')+'.png'),animations:'allow'});
   if(i%120===0)console.log('Rendered grain '+i+'/'+FRAMES);
 }
 encodeVideo(dir,path.join(OUT,'grain-rendered.webm'),FPS);
 const manifest={fps:FPS,frames:FRAMES,duration:FRAMES/FPS,geometry,observedScene,liveScene,sceneAtStart,grainTime,backgroundFPS,uiPhase:clock.css,clip,sourceHash:require('crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex'),method:'Actual live frontend scene: unchanged variant, CSS viewport, DPR, canvas size and shader scale; background starts at the most recently drawn live phase and advances at its production 30/10/60 fps cadence. Grain advances i/60. Synchronous GL readback then native-resolution PNG capture, with no crop, resize, forced variant, gamma simulation or real-time recorder.',encoding:'VP9 RGB lossless WebM; no YUV conversion or chroma subsampling.',errors:app.errors,samples};
 fs.writeFileSync(path.join(OUT,'render-manifest.json'),JSON.stringify(manifest,null,2));
 if(app.errors.length)throw new Error(app.errors.join('\n'));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});console.log('Rendered 600 frames at 60 fps, 10 seconds');
})().catch(e=>{console.error(e);process.exit(1);});
