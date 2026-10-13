// Offline 60 fps evidence: actual app + production GSAP, clock stepped per frame, PNG sequence -> FFmpeg.
// No recorder, interpolation, duplicate-frame repair or changed production easing/durations.
const fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep,until}=require('./common');
const {prepareTimeline,stepTimeline,waitPresentation,encodeVideo}=require('./visual-review');
const {createHost}=require('./host');

const OUT=process.env.ISLAND_OUT||'/tmp/halation-island-render',FPS=60,COUNT=Number(process.env.ISLAND_FRAMES||390);
fs.mkdirSync(OUT,{recursive:true});
const schedule=[{frame:30,action:'open'},{frame:65,action:'close'},{frame:100,action:'activate'},{frame:140,action:'open'},{frame:170,action:'close'},{frame:175,action:'open'},{frame:180,action:'close'},{frame:185,action:'open'},{frame:220,action:'close'},{frame:260,action:'finishing'},{frame:290,action:'complete'},{frame:340,action:'idle'}];
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'halation-render-'));
 const host=createHost(root,{tools:{}}),server=serve(),browser=await launch();
 const setup=async()=>{
 const app=await openApp(browser,server,host,{width:1440,height:900,motion:true});const page=app.page;
 await app.tab('grade');await app.appReady('grade');
await page.mouse.move(1100,800);await sleep(1200);
 // All setup finishes with a real clock. Production timelines then advance only when this script advances them.
 // Allow the software renderer time to deliver the clock command before its pause target.
 await waitPresentation(page);const clock=await prepareTimeline(page,undefined,1000);
 const scene=await page.evaluate(()=>window.__atmo.grainTest.scene());
 const grainTime=(await page.evaluate(()=>window.__atmo.grainTest.metrics())).time;
 await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),scene);
 app.reviewClock=clock;app.reviewScene=scene;app.reviewGrainTime=grainTime;
 await page.evaluate(()=>{
   window.__renderCSS=new Map();window.__renderTweens=[];
   const M=window.__motion,animate=M.animate;
   M.animate=(el,frames,o={})=>{const a=animate(el,frames,o);if(el.closest('#procIsland')&&a)window.__renderTweens.push({a,el,frames,o,start:window.__renderTime||0});return a;};
   window.__renderAction=name=>{
     const J=window.__shell.jobs,P=window.__procs;
     if(name==='activate'){
       const h=J.submit({tool:'grade',kind:'export-image',lane:'cpu',title:'cover.png',run:ctx=>{ctx.progress(.37,'Encoding');return new Promise(r=>window.__renderRelease=r);}});h.done.catch(()=>{});window.__renderJob=h.id;
     }else if(name==='open')P.openTray();else if(name==='close')P.closeTray({restore:false});
     else if(name==='finishing'){const j=window.__jobs.jobs.get(window.__renderJob);j.progress=.99;j.stage='Finalizing';window.__jobs.touch(j);}
     else if(name==='complete')window.__renderRelease();
     else if(name==='idle'){J.clearFinished();P.closePill(true);P.paintIsland();}
   };
 });
 return app;
 };
 let app,page;const errors=[];
 const rendered=[];
 // Two fresh frontend instances with the same timed actions; compare geometry at every frame.
 for(let pass=0;pass<2;pass++){
   app=await setup();page=app.page;
   const dir=path.join(OUT,pass===0?'island-rendered':'frames-1');fs.mkdirSync(dir,{recursive:true});
   const samples=[];
   for(let i=0;i<COUNT;i++){
     const ms=Math.floor(i*1000/FPS),t=i/FPS;
     await page.evaluate(t=>{window.__renderTime=t;},t);
     const ev=schedule.find(e=>e.frame===i);if(ev)await page.evaluate(n=>window.__renderAction(n),ev.action);
     await stepTimeline(page,app.reviewClock,i,FPS);
     const bgFPS={home:30,tool:10,mix:60}[app.reviewScene.mode];
     if(i===0||Math.floor(i*bgFPS/FPS)!==Math.floor((i-1)*bgFPS/FPS))await page.evaluate(s=>window.__atmo.grainTest.sceneAt(s),{...app.reviewScene,time:app.reviewScene.time+Math.floor(i*bgFPS/FPS)/bgFPS});
     await page.evaluate(t=>window.__atmo.grainTest.renderAt(t,true),app.reviewGrainTime+t);
     // Let onComplete/finished handlers restore real production DOM before sampling.
     await page.evaluate(()=>Promise.resolve());
     const s=await page.evaluate(()=>{
       const d=document.querySelector('#procIsland'),bg=d.querySelector('.isl-bg'),r=bg.getBoundingClientRect();
       return {state:d.dataset.state,kind:d.dataset.kind||'',expanded:d.classList.contains('expanded'),closing:d.classList.contains('closing'),rect:{x:r.x,y:r.y,w:r.width,h:r.height},transform:getComputedStyle(d).transform,bgTransform:getComputedStyle(bg).transform,
         tweens:window.__renderTweens.filter(x=>x.a.playState==='running').map(x=>({channel:x.o.channel,progress:x.a.tween.progress(),time:x.a.tween.time(),duration:x.a.tween.duration(),start:x.start,frames:x.frames}))};
     });
     await page.screenshot({path:path.join(dir,String(i).padStart(4,'0')+'.png'),animations:'allow'});
     samples.push({frame:i,time:t,...s});
     if(i%60===0)console.log('Rendered pass '+pass+' frame '+i+'/'+COUNT);
   }
   rendered.push(samples);fs.writeFileSync(path.join(OUT,'render-samples-'+pass+'.json'),JSON.stringify(samples));
   errors.push(...app.errors);await page.close();
 }
 const geometryMismatch=[];
 for(let i=0;i<COUNT;i++){
   const a=rendered[0][i],b=rendered[1][i];
   if(a.state!==b.state||a.kind!==b.kind||a.expanded!==b.expanded||a.closing!==b.closing||Object.keys(a.rect).some(k=>Math.abs(a.rect[k]-b.rect[k])>.02))geometryMismatch.push(i);

 }
 const info={fps:FPS,frames:COUNT,duration:COUNT/FPS,viewport:{width:1440,height:900},schedule,geometryMismatch,errors,method:'Shared visual-review clock and capture contract; production GSAP, CSS and grain advance at 60 fps; background retains its production 30/10/60 fps cadence; complete native-resolution viewport, no crop or rescale. MP4 H.264 High YUV420p BT.709 limited CRF 10 faststart with separate RGB verification; exact native PNG references; no real-time video.'};
 fs.writeFileSync(path.join(OUT,'render-manifest.json'),JSON.stringify(info,null,2));
 encodeVideo(path.join(OUT,'island-rendered'),path.join(OUT,'island-rendered.mp4'),FPS);
 console.log(JSON.stringify(info,null,2));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});
 if(geometryMismatch.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
